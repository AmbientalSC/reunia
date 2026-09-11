import React from 'react';
import { Clock, Users, Calendar, Tag } from 'lucide-react';

interface PageProps {
  params: {
    id: string;
  };
}

interface Note {
  title: string;
  date: string;
  time?: string;
  attendees?: string[];
  tags: string[];
  content: string;
}

export function generateStaticParams() {
  // Return all possible note IDs
  return [
    { id: 'team-sync-dec-26' },
    { id: 'product-review' },
    { id: 'project-ideas' },
    { id: 'action-items' }
  ];
}

const NotePage = ({ params }: PageProps) => {
  // This would normally come from your database
  const sampleData: Record<string, Note> = {
    'team-sync-dec-26': {
      title: 'Sincronização da Equipe - 26 de dezembro',
      date: '2024-12-26',
      time: '10:00 AM - 11:00 AM',
      attendees: ['John Doe', 'Jane Smith', 'Mike Johnson'],
      tags: ['Sincronização da Equipe', 'Semanal', 'Produto'],
      content: `
# Resumo da Reunião
Discussão da equipe sobre as metas do 1º trimestre de 2024 e o status atual do projeto.

## Itens da Pauta
1. Atualizações do Status do Projeto
2. Planejamento do 1º trimestre de 2024
3. Preocupações e Feedback da Equipe

## Decisões Principais
- Priorizamos o desenvolvimento do aplicativo móvel para o 1º trimestre
- Agendamos revisões semanais de design
- Adicionamos dois novos recursos ao roadmap

## Itens de Ação
- [ ] John: Criar o cronograma do projeto
- [ ] Jane: Agendar reuniões de revisão de design
- [ ] Mike: Atualizar a documentação

## Notas
- Discutimos os gargalos atuais do projeto
- Revisamos o feedback dos clientes do último lançamento
- Planejamos a alocação de recursos para a próxima sprint
      `
    },
    'product-review': {
      title: 'Revisão de Produto',
      date: '2024-12-26',
      time: '2:00 PM - 3:00 PM',
      attendees: ['Sarah Wilson', 'Tom Brown', 'Alex Chen'],
      tags: ['Produto', 'Revisão', 'Trimestral'],
      content: `
# Reunião de Revisão de Produto

## Visão Geral
Sessão trimestral de revisão de produto com as partes interessadas.

## Pontos de Discussão
1. Revisão de Desempenho do 4º trimestre
2. Priorização de Recursos
3. Análise de Feedback dos Clientes

## Itens de Ação
- [ ] Atualizar o roadmap do produto
- [ ] Agendar sessões de pesquisa com usuários
- [ ] Revisar a análise de concorrentes
      `
    },
    'project-ideas': {
      title: 'Ideias de Projeto',
      date: '2024-12-26',
      tags: ['Ideias', 'Planejamento'],
      content: `
# Ideias de Projeto

## Novos Recursos
1. Resumos de reuniões com IA
2. Integração com calendário
3. Ferramentas de colaboração em equipe

## Melhorias
- Funcionalidade de busca aprimorada
- Melhor organização de notas
- Colaboração em tempo real
      `
    },
    'action-items': {
      title: 'Itens de Ação',
      date: '2024-12-26',
      tags: ['Tarefas', 'Pendências', 'Planejamento'],
      content: `
# Itens de Ação

## Alta Prioridade
- [ ] Implantar a v2.0 em produção
- [ ] Corrigir problemas críticos de segurança
- [ ] Concluir a documentação do usuário

## Prioridade Média
- [ ] Atualizar dependências
- [ ] Implementar rastreamento de erros
- [ ] Adicionar testes unitários

## Baixa Prioridade
- [ ] Refatorar código legado
- [ ] Melhorar a documentação do código
- [ ] Estabelecer diretrizes de desenvolvimento
      `
    }
  };

  const note = sampleData[params.id as keyof typeof sampleData];

  if (!note) {
    return <div className="p-8">Nota não encontrada</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4">{note.title}</h1>
        
        <div className="flex flex-wrap gap-4 text-gray-600">
          {note.date && (
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{note.date}</span>
            </div>
          )}
          
          {note.time && (
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{note.time}</span>
            </div>
          )}
          
          {note.attendees && (
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>{note.attendees.join(', ')}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          {note.tags.map((tag) => (
            <div key={tag} className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm">
              <Tag className="w-3 h-3" />
              {tag}
            </div>
          ))}
        </div>
      </div>

      <div className="prose prose-blue max-w-none">
        <div dangerouslySetInnerHTML={{ __html: note.content.split('\n').map(line => {
          if (line.startsWith('# ')) {
            return `<h1>${line.slice(2)}</h1>`;
          } else if (line.startsWith('## ')) {
            return `<h2>${line.slice(3)}</h2>`;
          } else if (line.startsWith('- ')) {
            return `<li>${line.slice(2)}</li>`;
          }
          return line;
        }).join('\n') }} />
      </div>
    </div>
  );
};

export default NotePage;

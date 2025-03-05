package co.edu.uniquindio.Biblioteca.model;

import com.sun.source.doctree.EscapeTree;

public class Libro extends ItemBiblioteca {

    public enum EstadoLibro{

        DISPONIBLE,
        PRESTADO
    }
    private String autor;
    private String titulo;
    private String isbn;
    private EstadoLibro estado;

        public Libro(String autor,String titulo,String isbn){
            super(titulo);
            this.autor= autor;
            this.isbn= isbn;
            this.estado= EstadoLibro.DISPONIBLE;
    }

    public String getAutor(){
        return autor;
    }

    public void setAutor(String autor){
        this.autor= autor;

    }

    public String getTitulo(){
        return titulo;

    }

    public void setTitulo(String titulo){
        this.titulo= titulo;

    }

    public String getIsbn(){
        return isbn;

    }

    public void setIsbn(String isbn){
        this.isbn= isbn;

    }

    public EstadoLibro getEstado(){
        return estado;

    }

    public void setEstado(EstadoLibro estado) {
        this.estado = estado;
    }

    public void prestar() {
        if (estado == EstadoLibro.DISPONIBLE) {
            estado = EstadoLibro.PRESTADO;
        }
    }

    public void devolver() {
        estado = EstadoLibro.DISPONIBLE;
    }

    @Override
    public void mostrarInfo() {
        System.out.println(getTitulo() + " - " + autor + " [" + estado + "]");
    }

}



